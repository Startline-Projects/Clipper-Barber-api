import 'multer';
import {
  Body,
  Controller,
  Get,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';
import { ClientProfileResponseDto } from './dto/client-profile-response.dto';

@ApiTags('Client Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/profile')
export class ClientProfileController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get the authenticated client’s profile, including the next upcoming booking (recurring or one-off).',
  })
  @ApiResponse({ status: 200, type: ClientProfileResponseDto })
  public async getProfile(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<ClientProfileResponseDto> {
    return this.clientsService.getProfile(user);
  }

  @Patch()
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Update the authenticated client’s profile (name, username, photo)',
    description:
      'Send any subset of fields. A new `username` must be unique across clients. Use multipart/form-data when uploading a `photo`; otherwise application/json works just as well.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Optional profile photo (max 5 MB)',
        },
        name: { type: 'string', maxLength: 100 },
        username: { type: 'string', minLength: 3, maxLength: 30 },
      },
    },
  })
  @ApiResponse({ status: 200, type: ClientProfileResponseDto })
  public async updateProfile(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateClientProfileDto,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<ClientProfileResponseDto> {
    return this.clientsService.updateProfile(user, dto, photo);
  }
}
