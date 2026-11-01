import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateTransferDto, ListTransfersDto, UpdateTransferDto } from './dto/transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers') @ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private transfers: TransfersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListTransfersDto) {
    return this.transfers.list(u.id, q);
  }

  @Get(':id')
  findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.transfers.findOne(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTransferDto) {
    return this.transfers.create(u.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateTransferDto) {
    return this.transfers.update(u.id, id, dto);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.transfers.remove(u.id, id);
  }
}
