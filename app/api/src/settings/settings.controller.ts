import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsSchema, type Settings } from '@forge/shared';
import { ZodBody } from '../common/zod-body.pipe';
import { SettingsService } from './settings.service';

const PatchSettingsSchema = SettingsSchema.partial().strict();

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() { return this.settings.get(); }

  @Patch()
  patch(@Body(new ZodBody(PatchSettingsSchema)) body: Partial<Settings>) {
    return this.settings.update(body);
  }
}
