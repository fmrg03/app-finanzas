import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

const DEFAULTS: { name: string; type: TransactionType; color: string; icon: string }[] = [
  { name: 'Sueldo', type: 'INCOME', color: '#16a34a', icon: 'briefcase' },
  { name: 'Trabajos extra', type: 'INCOME', color: '#22c55e', icon: 'laptop' },
  { name: 'Otros ingresos', type: 'INCOME', color: '#4ade80', icon: 'plus-circle' },
  { name: 'Supermercado', type: 'EXPENSE', color: '#ea580c', icon: 'shopping-cart' },
  { name: 'Comida fuera', type: 'EXPENSE', color: '#f97316', icon: 'utensils' },
  { name: 'Transporte', type: 'EXPENSE', color: '#0ea5e9', icon: 'car' },
  { name: 'Servicios', type: 'EXPENSE', color: '#6366f1', icon: 'zap' },
  { name: 'Salud', type: 'EXPENSE', color: '#e11d48', icon: 'heart-pulse' },
  { name: 'Hogar', type: 'EXPENSE', color: '#a16207', icon: 'home' },
  { name: 'Entretenimiento', type: 'EXPENSE', color: '#a855f7', icon: 'film' },
  { name: 'Otros gastos', type: 'EXPENSE', color: '#64748b', icon: 'circle' },
];

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  /** Devuelve las categorías raíz con sus subcategorías anidadas. */
  findAll(userId: string, type?: TransactionType) {
    return this.prisma.category.findMany({
      where: { userId, parentId: null, ...(type ? { type } : {}) },
      include: { children: { orderBy: { name: 'asc' } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const cat = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return cat;
  }

  async create(userId: string, dto: CreateCategoryDto) {
    const name = dto.name.trim();
    await this.validateParent(userId, dto.parentId ?? null, dto.type);
    await this.assertNameFree(userId, dto.parentId ?? null, name);
    return this.prisma.category.create({
      data: {
        userId, name, type: dto.type, color: dto.color, icon: dto.icon,
        parentId: dto.parentId ?? null, defaultRateSource: dto.defaultRateSource ?? null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    const cat = await this.findOne(userId, id);
    const type = dto.type ?? cat.type;
    const parentId = dto.parentId === undefined ? cat.parentId : dto.parentId;
    const name = dto.name?.trim() ?? cat.name;

    if (parentId === id) throw new BadRequestException('Una categoría no puede ser su propia padre');
    if (dto.type && dto.type !== cat.type) {
      const used = await this.prisma.transaction.count({ where: { categoryId: id } });
      if (used) throw new BadRequestException('No puedes cambiar el tipo de una categoría con movimientos');
      const kids = await this.prisma.category.count({ where: { parentId: id } });
      if (kids) throw new BadRequestException('Cambia primero el tipo de sus subcategorías o muévelas');
    }
    if (parentId && parentId !== cat.parentId) {
      const kids = await this.prisma.category.count({ where: { parentId: id } });
      if (kids) throw new BadRequestException('Una categoría con subcategorías no puede volverse subcategoría');
    }
    await this.validateParent(userId, parentId, type);
    if (name !== cat.name || parentId !== cat.parentId) await this.assertNameFree(userId, parentId, name, id);

    return this.prisma.category.update({
      where: { id },
      data: {
        name, type, parentId, color: dto.color, icon: dto.icon,
        ...(dto.defaultRateSource === undefined ? {} : { defaultRateSource: dto.defaultRateSource }),
      },
    });
  }

  /** Borra la categoría. Sus movimientos quedan sin categoría y sus hijas pasan a raíz. */
  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.category.delete({ where: { id } });
  }

  /** Crea un juego inicial de categorías; solo si el usuario aún no tiene ninguna. */
  async seedDefaults(userId: string) {
    const existing = await this.prisma.category.count({ where: { userId } });
    if (existing) throw new ConflictException('Ya tienes categorías; las predeterminadas solo se crean en una cuenta vacía');
    await this.prisma.category.createMany({ data: DEFAULTS.map((c) => ({ ...c, userId })) });
    return this.findAll(userId);
  }

  private async validateParent(userId: string, parentId: string | null, type: TransactionType) {
    if (!parentId) return;
    const parent = await this.prisma.category.findFirst({ where: { id: parentId, userId } });
    if (!parent) throw new BadRequestException('La categoría padre no existe');
    if (parent.parentId) throw new BadRequestException('Solo se permite un nivel de subcategorías');
    if (parent.type !== type) throw new BadRequestException('La subcategoría debe ser del mismo tipo que su padre');
  }

  // La restricción única de la BD no cubre parentId = NULL (Postgres trata NULL como distinto)
  private async assertNameFree(userId: string, parentId: string | null, name: string, exceptId?: string) {
    const dup = await this.prisma.category.findFirst({
      where: { userId, parentId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (dup) throw new ConflictException(`Ya existe la categoría "${name}" en ese nivel`);
  }
}
