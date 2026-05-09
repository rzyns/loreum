import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { ApiKeysService } from "../../api-keys/api-keys.service";
import { AuthUser } from "../types/jwt.types";

/**
 * Combined auth guard: cookie → JWT (Passport), Bearer → API key (SHA-256).
 */
@Injectable()
export class ApiKeyAuthGuard extends AuthGuard("jwt") implements CanActivate {
  constructor(private apiKeysService: ApiKeysService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.cookies?.["auth_token"]) {
      return super.canActivate(context) as Promise<boolean>;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("No valid authentication provided");
    }

    const token = authHeader.slice(7);
    const apiKey = await this.apiKeysService.validate(token);

    const user: AuthUser = {
      id: apiKey.project.ownerId,
      email: "",
      roles: ["USER"],
      sessionId: "",
      apiKey: {
        id: apiKey.id,
        projectId: apiKey.project.id,
        projectSlug: apiKey.project.slug,
        permissions: apiKey.permissions,
      },
    };

    this.authorizeApiKeyRequest(request, user);

    request.user = user;
    return true;
  }

  private authorizeApiKeyRequest(request: Request, user: AuthUser) {
    const method = request.method.toUpperCase();
    const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);

    this.ensureApiKeyProjectScope(request, user);

    if (!isMutation) {
      return;
    }

    const permission = user.apiKey?.permissions;
    const isDraftMutation = /\/drafts(?:\/|$)/.test(request.path);
    const canMutate = isDraftMutation
      ? permission === "DRAFT_WRITE" ||
        permission === "DRAFT_WRITE_SELF_APPROVE" ||
        permission === "CANONICAL_WRITE" ||
        permission === "READ_WRITE"
      : permission === "CANONICAL_WRITE" || permission === "READ_WRITE";

    if (!canMutate) {
      throw new ForbiddenException(
        isDraftMutation
          ? "API key does not have draft-write permission"
          : "API key does not have canonical write permission",
      );
    }

    if (!this.getRequestedProjectIdentifier(request)) {
      throw new ForbiddenException(
        "Project-scoped API keys cannot perform account-level writes",
      );
    }
  }

  private ensureApiKeyProjectScope(request: Request, user: AuthUser) {
    const requestedProject = this.getRequestedProjectIdentifier(request);
    if (!requestedProject) {
      return;
    }

    if (
      requestedProject !== user.apiKey?.projectSlug &&
      requestedProject !== user.apiKey?.projectId
    ) {
      throw new ForbiddenException(
        "API key is not authorized for the requested project",
      );
    }
  }

  private getRequestedProjectIdentifier(request: Request): string | undefined {
    const params = request.params ?? {};
    const identifier = params.projectSlug ?? params.projectId ?? params.slug;
    return Array.isArray(identifier) ? identifier[0] : identifier;
  }
}
