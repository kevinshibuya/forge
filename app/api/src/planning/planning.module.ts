import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdeasModule } from '../ideas/ideas.module';
import { PlaybookModule } from '../playbook/playbook.module';
import { PostsModule } from '../posts/posts.module';
import { SettingsModule } from '../settings/settings.module';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

@Module({
  imports: [PostsModule, IdeasModule, AnalyticsModule, PlaybookModule, SettingsModule],
  providers: [PlanningService],
  controllers: [PlanningController],
  exports: [PlanningService],
})
export class PlanningModule {}
