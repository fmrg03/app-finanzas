import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@ApiTags('categories') @ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private categories: CategoriesService) {}

  @Get()
  @ApiQuery({ name: 'type', required: false, enum: TransactionType })
  findAll(@CurrentUser() u: AuthUser, @Query('type', new ParseEnumPipe(TransactionType, { optional: true })) type?: TransactionType) {
    return this.categories.findAll(u.id, type);
  }

  @Post('defaults')
  seedDefaults(@CurrentUser() u: AuthUser) {
    return this.categories.seedDefaults(u.id);
  }

  @Get(':id')
  findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.categories.findOne(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(u.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(u.id, id, dto);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.categories.remove(u.id, id);
  }
}
