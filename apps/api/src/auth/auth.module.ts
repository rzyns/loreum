import { Module, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { AppConfig } from "../config/app.config";
import { AuthService } from "./services/auth.service";
import { CookieService } from "./services/cookie.service";
import { PasswordService } from "./services/password.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";
import { AuthController } from "./controllers/auth.controller";
import { CsrfMiddleware } from "./middleware/csrf.middleware";
import { ProjectCapabilitiesService } from "./project-capabilities.service";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
        signOptions: { expiresIn: config.jwt.accessTTL },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CookieService,
    PasswordService,
    JwtStrategy,
    GoogleStrategy,
    ProjectCapabilitiesService,
    // Uncomment as providers are added:
    // DiscordStrategy,
    // MicrosoftStrategy,
    // LinkedInStrategy,
  ],
  exports: [AuthService, ProjectCapabilitiesService],
})
export class AuthModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfMiddleware)
      .exclude(
        // OAuth redirects don't need CSRF
        { path: "auth/google", method: RequestMethod.GET },
        { path: "auth/google/callback", method: RequestMethod.GET },
        // Bearer-auth endpoints (MCP, mobile) skip CSRF
        // The middleware itself also skips when no auth cookie is present
      )
      .forRoutes("*path");
  }
}
