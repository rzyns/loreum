import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { EntitiesModule } from "../entities/entities.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { RelationshipsController } from "./relationships.controller";
import { RelationshipDraftsController } from "./relationship-drafts.controller";
import { RelationshipsService } from "./relationships.service";
import { RelationshipDraftsService } from "./relationship-drafts.service";

@Module({
  imports: [ProjectsModule, EntitiesModule, AuditModule, AuthModule],
  controllers: [RelationshipsController, RelationshipDraftsController],
  providers: [RelationshipsService, RelationshipDraftsService],
  exports: [RelationshipsService, RelationshipDraftsService],
})
export class RelationshipsModule {}
