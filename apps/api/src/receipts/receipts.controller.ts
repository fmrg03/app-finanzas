import {
  Body, Controller, Get, Param, ParseFilePipe, MaxFileSizeValidator, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateTransactionDto } from '../transactions/dto/transaction.dto';
import { ReceiptsService } from './receipts.service';

const MAX_BYTES = 10 * 1024 * 1024;

@ApiTags('receipts') @ApiBearerAuth()
@Controller('receipts')
export class ReceiptsController {
  constructor(private receipts: ReceiptsService) {}

  /** Si la lectura de facturas está disponible (hay API key configurada). */
  @Get('status')
  status() {
    return this.receipts.status();
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: false, validators: [new MaxFileSizeValidator({ maxSize: MAX_BYTES, message: 'El archivo supera 10 MB' })] }))
    file?: Express.Multer.File,
  ) {
    return this.receipts.upload(u.id, file);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateTransactionDto) {
    return this.receipts.confirm(u.id, id, dto);
  }

  @Get(':id/file')
  async file(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { buffer, mime } = await this.receipts.file(u.id, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }
}
