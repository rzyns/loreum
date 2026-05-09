import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { EntitiesController } from "./entities.controller";
import { EntityDraftsController } from "./entity-drafts.controller";
import { EntityDraftsService } from "./entity-drafts.service";
import { EntitiesService } from "./entities.service";

@Module({
  imports: [ProjectsModule, AuthModule, AuditModule],
  controllers: [EntitiesController, EntityDraftsController],
  providers: [EntitiesService, EntityDraftsService],
  exports: [EntitiesService, EntityDraftsService],
})
export class EntitiesModule {}
