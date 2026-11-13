import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parseQueryInt } from '../common/query-parse';
import { AnalyticsService, isBoardRange } from './analytics.service';
import { XlsxShapeError } from './xlsx-parser';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @UploadedFile() file?: Express.Multer.File,
    @Query('postId') postId?: string,
    // presence is the signal: `?force`, `?force=`, `?force=1` all mean force.
    @Query('force') force?: string,
  ) {
    if (!file) throw new BadRequestException('multipart field "file" (xlsx) is required');
    try {
      return await this.analytics.importXlsx(
        { buffer: file.buffer, originalname: file.originalname },
        {
          postId: postId ? parseQueryInt(postId, 'postId') : undefined,
          force: force !== undefined,
        },
      );
    } catch (err) {
      if (err instanceof XlsxShapeError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Hand-attach an imported urn to an app post. 404 unknown urn/post, 409 post already taken. */
  @Post('link')
  link(@Body() body: { postUrn?: unknown; postId?: unknown }) {
    const { postUrn, postId } = body ?? {};
    if (typeof postUrn !== 'string' || postUrn.trim() === '') {
      throw new BadRequestException('postUrn (string) is required');
    }
    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      throw new BadRequestException('postId (integer) is required');
    }
    return this.analytics.link(postUrn, postId);
  }

  /** The post-detail page's aggregate. The pivot behind `forPost()` stays, but off HTTP. */
  @Get('posts/:postId')
  postDetail(@Param('postId', ParseIntPipe) postId: number) {
    return this.analytics.postDetail(postId);
  }

  /** `range` absent → 28; anything outside the set → 400 (the service re-checks it too). */
  @Get('board')
  board(@Query('range') range?: string) {
    const value = range ?? '28';
    if (!isBoardRange(value)) throw new BadRequestException('range must be 7, 28, 90 or all');
    return this.analytics.board(value);
  }

  /** `window` absent → 28; non-numeric → 400 here, an out-of-set value → 400 in the service. */
  @Get('overview')
  overview(@Query('window') window?: string) {
    return this.analytics.overview(window === undefined ? 28 : parseQueryInt(window, 'window'));
  }
}
