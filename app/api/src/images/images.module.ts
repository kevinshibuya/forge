import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { RunnerModule } from '../runner/runner.module';
import { RunsModule } from '../runs/runs.module';
import { SettingsModule } from '../settings/settings.module';
import { PlaybookModule } from '../playbook/playbook.module';
import { PostsModule } from '../posts/posts.module';
import { RENDERER, PlaywrightRenderer } from './render.service';
import { ImagesService } from './images.service';
import { ImageComposeService } from './image-compose.service';
import { ImageGenService } from './image-gen.service';
import { ImageRefineService } from './image-refine.service';
import { ImageReviewService } from './image-review.service';
import { ImagesController } from './images.controller';

@Module({
  imports: [DbModule, RunnerModule, RunsModule, SettingsModule, PlaybookModule, PostsModule],
  controllers: [ImagesController],
  providers: [ImagesService, ImageComposeService, ImageGenService, ImageRefineService, ImageReviewService, { provide: RENDERER, useClass: PlaywrightRenderer }],
  exports: [ImagesService, ImageComposeService, ImageGenService, ImageRefineService, ImageReviewService, RENDERER],
})
export class ImagesModule {}
