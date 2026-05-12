import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { LoreArticleDraftsController } from "./lore-article-drafts.controller";
import { LoreArticleDraftsService } from "./lore-article-drafts.service";
import { LoreController } from "./lore.controller";
import { LoreService } from "./lore.service";

@Module({
  imports: [ProjectsModule, AuthModule, AuditModule],
  controllers: [LoreController, LoreArticleDraftsController],
  providers: [LoreService, LoreArticleDraftsService],
  exports: [LoreService, LoreArticleDraftsService],
})
export class LoreModule {}
