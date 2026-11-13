import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { InputsController } from './inputs.controller';
import { InputsService } from './inputs.service';

@Module({
  imports: [PostsModule],
  providers: [InputsService],
  controllers: [InputsController],
  exports: [InputsService],
})
export class InputsModule {}
