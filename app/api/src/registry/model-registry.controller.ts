import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ModelRowPatchSchema, type ModelRowPatch } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { ModelRegistryService } from './model-registry.service';

@Controller('registry')
export class ModelRegistryController {
  constructor(private readonly registry: ModelRegistryService) {}

  @Get()
  list() { return this.registry.list(); }

  @Patch(':id')
  patch(@Param('id', ParseIntPipe) id: number, @Body(new ZodBody(ModelRowPatchSchema)) body: ModelRowPatch) {
    return this.registry.patch(id, body);
  }
}
