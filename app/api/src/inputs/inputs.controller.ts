import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { INPUT_CAPS, REFUSAL } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { InputsService, type Submission } from './inputs.service';

const SubmissionSchema = z.object({ text: z.string().trim().min(1).optional() });

/** The multer limit is the api edge's own cap: a 5 MB + 1 upload is a 413 before any producer
 *  runs. `files: 1` is what makes a second file a refusal rather than a silent drop. */
const UPLOAD = { limits: { fileSize: INPUT_CAPS.bytes, files: 1 } };

@Controller('posts/:id/inputs')
export class InputsController {
  constructor(private readonly inputs: InputsService) {}

  /** Exactly one of the two, so an operator never wonders which half was read. */
  private submission(file: Express.Multer.File | undefined, text: string | undefined): Submission {
    if (file && text !== undefined) throw new BadRequestException('send a file or a text, not both or neither');
    if (file) {
      if (/[/\\]/.test(file.originalname)) throw new BadRequestException(REFUSAL.badName);
      return { file: { name: file.originalname, buffer: file.buffer } };
    }
    if (text !== undefined) return { text };
    throw new BadRequestException('send a file or a text, not both or neither');
  }

  @Get()
  list(@Param('id', ParseIntPipe) id: number) {
    return this.inputs.list(id);
  }

  // 200, not Nest's default 201: a preview creates nothing, and a refusal is a normal answer.
  @Post('preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  preview(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(SubmissionSchema)) body: z.infer<typeof SubmissionSchema>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.inputs.preview(id, this.submission(file, body.text));
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  attach(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(SubmissionSchema)) body: z.infer<typeof SubmissionSchema>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.inputs.attach(id, this.submission(file, body.text));
  }

  @Delete(':inputId')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Param('inputId', ParseIntPipe) inputId: number,
  ) {
    await this.inputs.remove(id, inputId);
  }
}
