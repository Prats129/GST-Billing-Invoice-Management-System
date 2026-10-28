import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  archiveInputSchema,
  businessProfileInputSchema,
  customerInputSchema,
  catalogInputSchema,
  directoryQuerySchema,
  taxReviewSchema,
  businessProfileResponseSchema,
  businessProfileViewSchema,
  customerViewSchema,
  customerPageSchema,
  catalogViewSchema,
  catalogPageSchema,
  taxHistorySchema,
} from '@gst/contracts';
import type { Request } from 'express';
import {
  SECURITY,
  SecurityController,
  contractBody,
  contractResponse,
  input,
  uuid,
} from '../security/controllers.js';
import type { SecurityServices } from '../security/controllers.js';
import type { BusinessService } from './business.service.js';
import { deny } from '../security/errors.js';

export const BUSINESS = Symbol('BUSINESS');
@ApiTags('business setup, customers and catalog')
@ApiCookieAuth()
@ApiHeader({
  name: 'x-csrf-token',
  required: false,
  description: 'Required on mutations with exact Origin.',
})
@Controller('organizations/:orgId')
@ApiResponse({
  status: 409,
  description:
    'Stale version, duplicate code, archived record or concurrent state conflict; reload before retrying.',
})
export class BusinessController extends SecurityController {
  constructor(
    @Inject(SECURITY) services: SecurityServices | null,
    @Inject(BUSINESS) readonly businessService: BusinessService | null,
  ) {
    super(services);
  }
  private get business() {
    return this.businessService ?? deny('SECURITY_UNAVAILABLE');
  }
  @Get('business-profile')
  @contractResponse(businessProfileResponseSchema)
  @ApiOperation({
    summary:
      'Read business setup and the active GST registration; null when not configured',
  })
  async profile(@Param('orgId') orgId: string, @Req() req: Request) {
    return {
      profile: await this.business.profile(
        await this.authenticated(req),
        uuid(orgId),
      ),
    };
  }
  @Put('business-profile')
  @contractResponse(businessProfileViewSchema)
  @contractBody(businessProfileInputSchema)
  async saveProfile(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.business.saveProfile(
      await this.authenticated(req, true),
      uuid(orgId),
      input(businessProfileInputSchema, body),
    );
  }
  @Get('customers')
  @contractResponse(customerPageSchema)
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Literal name/code/GSTIN search, up to 80 characters.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'archived', 'all'],
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: '0–10000; pages contain up to 50 records.',
  })
  async customers(
    @Param('orgId') orgId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.business.listCustomers(
      await this.authenticated(req),
      uuid(orgId),
      input(directoryQuerySchema, query),
    );
  }
  @Get('customers/:id')
  @contractResponse(customerViewSchema)
  async customer(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.business.customer(
      await this.authenticated(req),
      uuid(orgId),
      uuid(id),
    );
  }
  @Post('customers')
  @contractResponse(customerViewSchema, 201)
  @contractBody(customerInputSchema)
  async createCustomer(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.business.saveCustomer(
      await this.authenticated(req, true),
      uuid(orgId),
      input(customerInputSchema, body),
    );
  }
  @Put('customers/:id')
  @contractResponse(customerViewSchema)
  @contractBody(customerInputSchema)
  async updateCustomer(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.business.saveCustomer(
      await this.authenticated(req, true),
      uuid(orgId),
      input(customerInputSchema, body),
      uuid(id),
    );
  }
  @Put('customers/:id/archive')
  @contractBody(archiveInputSchema)
  async archiveCustomer(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const data = input(archiveInputSchema, body);
    return this.business.archive(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      'customers',
      data.version,
      data.archived,
    );
  }
  @Get('catalog')
  @contractResponse(catalogPageSchema)
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Literal name/code search, up to 80 characters.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'archived', 'all'],
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: '0–10000; pages contain up to 50 records.',
  })
  async catalog(
    @Param('orgId') orgId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.business.listCatalog(
      await this.authenticated(req),
      uuid(orgId),
      input(directoryQuerySchema, query),
    );
  }
  @Get('catalog/:id')
  @contractResponse(catalogViewSchema)
  async item(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.business.catalogItem(
      await this.authenticated(req),
      uuid(orgId),
      uuid(id),
    );
  }
  @Post('catalog')
  @contractResponse(catalogViewSchema, 201)
  @contractBody(catalogInputSchema)
  async createItem(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.business.saveCatalog(
      await this.authenticated(req, true),
      uuid(orgId),
      input(catalogInputSchema, body),
    );
  }
  @Put('catalog/:id')
  @contractResponse(catalogViewSchema)
  @contractBody(catalogInputSchema)
  async updateItem(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.business.saveCatalog(
      await this.authenticated(req, true),
      uuid(orgId),
      input(catalogInputSchema, body),
      uuid(id),
    );
  }
  @Put('catalog/:id/archive')
  @contractBody(archiveInputSchema)
  async archiveItem(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const data = input(archiveInputSchema, body);
    return this.business.archive(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      'catalog',
      data.version,
      data.archived,
    );
  }
  @Post('catalog/:id/tax-review')
  @contractResponse(catalogViewSchema, 201)
  @contractBody(taxReviewSchema)
  async reviewTax(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const data = input(taxReviewSchema, body);
    return this.business.reviewTax(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      data.version,
      data.reference,
    );
  }
  @Get('catalog/:id/tax-history')
  @contractResponse(taxHistorySchema)
  @ApiOperation({
    summary:
      'Latest 100 immutable classification revisions, newest first; not a statutory rate directory',
  })
  async taxHistory(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.business.taxHistory(
      await this.authenticated(req),
      uuid(orgId),
      uuid(id),
    );
  }
}
