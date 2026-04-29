import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { slugify } from "../common/utils/slug";

type EntitySearchMetadata = { entityType: string };
type LoreSearchMetadata = { category?: string };
type TimelineSearchMetadata = { date?: string; significance?: string };
type SceneSearchMetadata = { chapterId: string };

type SearchResult =
  | {
      id: string;
      type: "entity";
      title: string;
      slug?: string;
      excerpt?: string;
      metadata: EntitySearchMetadata;
    }
  | {
      id: string;
      type: "lore";
      title: string;
      slug?: string;
      excerpt?: string;
      metadata: LoreSearchMetadata;
    }
  | {
      id: string;
      type: "timeline";
      title: string;
      excerpt?: string;
      metadata: TimelineSearchMetadata;
    }
  | {
      id: string;
      type: "scene";
      title: string;
      excerpt?: string;
      metadata: SceneSearchMetadata;
    };

const SEARCH_TYPES = ["entity", "lore", "timeline", "scene"] as const;
type SearchType = (typeof SEARCH_TYPES)[number];
type SearchParam = string | string[];

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    const slug = await this.generateUniqueSlug(dto.name);

    return this.prisma.project.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        ownerId: userId,
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findBySlug(slug: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { slug },
    });

    if (!project) {
      throw new NotFoundException(`Project not found`);
    }

    this.assertOwner(project.ownerId, userId);
    return project;
  }

  async findPublicBySlug(slug: string) {
    const project = await this.prisma.project.findUnique({
      where: { slug },
    });

    if (!project || project.visibility === "PRIVATE") {
      throw new NotFoundException("Project not found");
    }

    return project;
  }

  async search(
    slug: string,
    userId: string,
    params: { q?: SearchParam; types?: SearchParam; limit?: SearchParam },
  ): Promise<{ query: string; total: number; results: SearchResult[] }> {
    const project = await this.findBySlug(slug, userId);
    const query = (this.firstQueryValue(params.q) ?? "").trim();
    if (!query) return { query: "", total: 0, results: [] };

    const limit = this.normalizeSearchLimit(params.limit);
    const selectedTypes = this.normalizeSearchTypes(params.types);
    if (selectedTypes.length === 0) return { query, total: 0, results: [] };

    const results: SearchResult[] = [];
    const contains = { contains: query, mode: "insensitive" as const };

    if (selectedTypes.includes("entity")) {
      const entities = await this.prisma.entity.findMany({
        where: {
          projectId: project.id,
          OR: [
            { name: contains },
            { summary: contains },
            { description: contains },
            { backstory: contains },
            { notes: contains },
          ],
        },
        select: {
          id: true,
          type: true,
          name: true,
          slug: true,
          summary: true,
          description: true,
          backstory: true,
          notes: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit,
      });
      results.push(
        ...entities.map((entity) => ({
          id: entity.id,
          type: "entity" as const,
          title: entity.name,
          slug: entity.slug,
          excerpt: this.firstPresent(
            entity.summary,
            entity.description,
            entity.backstory,
            entity.notes,
          ),
          metadata: { entityType: entity.type },
        })),
      );
    }

    if (selectedTypes.includes("lore")) {
      const loreArticles = await this.prisma.loreArticle.findMany({
        where: {
          projectId: project.id,
          OR: [
            { title: contains },
            { content: contains },
            { category: contains },
          ],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          category: true,
        },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: limit,
      });
      results.push(
        ...loreArticles.map((article) => ({
          id: article.id,
          type: "lore" as const,
          title: article.title,
          slug: article.slug,
          excerpt: this.firstPresent(article.content),
          metadata: this.omitNullish({ category: article.category }),
        })),
      );
    }

    if (selectedTypes.includes("timeline")) {
      const timelineEvents = await this.prisma.timelineEvent.findMany({
        where: {
          projectId: project.id,
          OR: [
            { name: contains },
            { description: contains },
            { date: contains },
            { significance: contains },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          date: true,
          significance: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        take: limit,
      });
      results.push(
        ...timelineEvents.map((event) => ({
          id: event.id,
          type: "timeline" as const,
          title: event.name,
          excerpt: this.firstPresent(event.description),
          metadata: this.omitNullish({
            date: event.date,
            significance: event.significance,
          }),
        })),
      );
    }

    if (selectedTypes.includes("scene")) {
      const scenes = await this.prisma.scene.findMany({
        where: {
          chapter: { work: { projectId: project.id } },
          OR: [
            { title: contains },
            { description: contains },
            { content: contains },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          content: true,
          chapterId: true,
          sequenceNumber: true,
          chapter: {
            select: {
              sequenceNumber: true,
              work: { select: { chronologicalOrder: true } },
            },
          },
        },
        orderBy: [
          { chapter: { work: { chronologicalOrder: "asc" } } },
          { chapter: { sequenceNumber: "asc" } },
          { sequenceNumber: "asc" },
          { id: "asc" },
        ],
        take: limit,
      });
      results.push(
        ...scenes.map((scene) => ({
          id: scene.id,
          type: "scene" as const,
          title: scene.title ?? "Untitled scene",
          excerpt: this.firstPresent(scene.description, scene.content),
          metadata: { chapterId: scene.chapterId },
        })),
      );
    }

    const limitedResults = results.slice(0, limit);
    return { query, total: limitedResults.length, results: limitedResults };
  }

  async update(slug: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.findBySlug(slug, userId);

    const data: Record<string, unknown> = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = await this.generateUniqueSlug(dto.name, project.id);
    }

    return this.prisma.project.update({
      where: { id: project.id },
      data,
    });
  }

  async delete(slug: string, userId: string) {
    const project = await this.findBySlug(slug, userId);

    await this.prisma.project.delete({
      where: { id: project.id },
    });
  }

  async saveTimelineConfig(
    slug: string,
    userId: string,
    config: {
      timelineMode?: string;
      timelineStart?: number;
      timelineEnd?: number;
      timelineLabelPrefix?: string;
      timelineLabelSuffix?: string;
    },
  ) {
    const project = await this.findBySlug(slug, userId);
    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(config.timelineMode !== undefined && {
          timelineMode: config.timelineMode,
        }),
        timelineStart: config.timelineStart,
        timelineEnd: config.timelineEnd,
        timelineLabelPrefix: config.timelineLabelPrefix,
        timelineLabelSuffix: config.timelineLabelSuffix,
      },
      select: {
        timelineMode: true,
        timelineStart: true,
        timelineEnd: true,
        timelineLabelPrefix: true,
        timelineLabelSuffix: true,
      },
    });
  }

  async patchGraphLayout(
    slug: string,
    userId: string,
    patch: Record<string, { x: number; y: number }>,
  ) {
    const project = await this.findBySlug(slug, userId);
    await this.prisma.$executeRaw`
      UPDATE projects
      SET "graphLayout" = COALESCE("graphLayout", '{}') || ${JSON.stringify(patch)}::jsonb
      WHERE id = ${project.id}
    `;
    return patch; // $executeRaw returns an affected row count, not the updated record, which is why we return patch directly instead of the updated project.
  }

  private assertOwner(ownerId: string, userId: string) {
    if (ownerId !== userId) {
      throw new ForbiddenException("You do not own this project");
    }
  }

  private normalizeSearchLimit(limit?: SearchParam): number {
    const normalizedLimit = this.firstQueryValue(limit);
    if (!normalizedLimit || !/^\d+$/.test(normalizedLimit)) return 20;
    const parsed = Number.parseInt(normalizedLimit, 10);
    if (parsed < 1) return 20;
    return Math.min(50, Math.max(1, parsed));
  }

  private normalizeSearchTypes(types?: SearchParam): SearchType[] {
    const normalizedTypes = this.firstQueryValue(types);
    if (!normalizedTypes) return [...SEARCH_TYPES];
    const requested = new Set(
      normalizedTypes
        .split(",")
        .map((type) => type.trim())
        .filter((type): type is SearchType =>
          SEARCH_TYPES.includes(type as SearchType),
        ),
    );
    return SEARCH_TYPES.filter((type) => requested.has(type));
  }

  private firstQueryValue(value?: SearchParam): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  private omitNullish<T extends Record<string, string | null | undefined>>(
    metadata: T,
  ): { [K in keyof T]?: string } {
    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ) as { [K in keyof T]?: string };
  }

  private firstPresent(...values: Array<string | null | undefined>) {
    return (
      values.find((value) => value && value.trim().length > 0) ?? undefined
    );
  }

  private async generateUniqueSlug(
    name: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(name);
    let slug = base;
    let counter = 0;

    while (true) {
      const existing = await this.prisma.project.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!existing || existing.id === excludeId) return slug;
      counter++;
      slug = `${base}-${counter}`;
    }
  }
}
