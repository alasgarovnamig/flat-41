import { Controller, HttpStatus, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { AppError } from '../../common/errors';
import { StorageService } from './storage.service';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) =>
        ALLOWED_MIME.includes(file.mimetype)
          ? cb(null, true)
          : cb(new AppError('UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG, WEBP or HEIC images are allowed', HttpStatus.UNSUPPORTED_MEDIA_TYPE), false),
    }),
  )
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.uploads.uploadImage(user.id, file);
  }
}

@Module({ controllers: [UploadsController], providers: [StorageService, UploadsService], exports: [StorageService, UploadsService] })
export class UploadsModule {}
