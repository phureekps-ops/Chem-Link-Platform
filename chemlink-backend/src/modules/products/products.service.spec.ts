import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  const prismaMock = {
    product: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    companyRole: {
      findUnique: jest.fn(),
    },
  };

  const service = new ProductsService(prismaMock as any);

  beforeEach(() => jest.clearAllMocks());

  describe('update (ownership check)', () => {
    it('rejects updating a product owned by a different company', async () => {
      prismaMock.product.findUnique.mockResolvedValueOnce({
        id: 'prod-1',
        sellerCompanyId: 'company-a',
      });

      await expect(service.update('company-b', 'prod-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.product.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prismaMock.product.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('company-a', 'missing', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows updating a product the company owns', async () => {
      prismaMock.product.findUnique.mockResolvedValueOnce({
        id: 'prod-1',
        sellerCompanyId: 'company-a',
      });
      prismaMock.product.update.mockResolvedValueOnce({ id: 'prod-1' });

      await service.update('company-a', 'prod-1', { name: 'Updated name' });
      expect(prismaMock.product.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('create (verified-seller check, Section 14.3)', () => {
    it('rejects when the company has not activated the SELLER role', async () => {
      prismaMock.companyRole.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create('company-a', { categoryId: 'cat-1', name: 'Test product' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the SELLER role exists but is not VERIFIED', async () => {
      prismaMock.companyRole.findUnique.mockResolvedValueOnce({ verificationStatus: 'PENDING' });
      await expect(
        service.create('company-a', { categoryId: 'cat-1', name: 'Test product' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
