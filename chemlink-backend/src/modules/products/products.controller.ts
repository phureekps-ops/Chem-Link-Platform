import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RoleType } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SearchProductsDto } from './dto/search-products.dto';
import { AddProductDocumentDto } from './dto/add-product-document.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // --- Public catalog & search (Section 5.2) — no auth required ---

  @Get()
  search(@Query() query: SearchProductsDto) {
    return this.productsService.search(query);
  }

  // Must come before ':id' so "mine" isn't parsed as a product id.
  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.productsService.findMineByCompany(user.companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findPublishedById(id);
  }

  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.productsService.listDocuments(id);
  }

  // --- Seller-only catalog management (Section 5.6, 14.3) ---

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.create(user.companyId, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.update(user.companyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.remove(user.companyId, id);
  }

  @Post(':id/documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  addDocument(
    @Param('id') id: string,
    @Body() dto: AddProductDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.addDocument(user.companyId, id, dto);
  }

  @Delete(':id/documents/:documentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.SELLER)
  removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.removeDocument(user.companyId, id, documentId);
  }
}
