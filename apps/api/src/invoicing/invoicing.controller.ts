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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  createInvoiceSchema,
  invoiceDraftSchema,
  finalizeInvoiceSchema,
  reverseInvoiceSchema,
  invoiceListQuerySchema,
  invoiceRecordSchema,
  invoicePreviewSchema,
  invoicePageSchema,
  correctionInputSchema,
  cancelInvoiceSchema,
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
import { deny } from '../security/errors.js';
import type { InvoicingService } from './invoicing.service.js';
export const INVOICING = Symbol('INVOICING');
@ApiTags('invoices')
@ApiCookieAuth()
@ApiHeader({
  name: 'x-csrf-token',
  required: false,
  description: 'Required with exact Origin on mutations.',
})
@ApiResponse({
  status: 409,
  description:
    'Version conflict, changed preview, archived master data or issuance/compliance gate. No number is consumed.',
})
@Controller('organizations/:orgId/invoices')
export class InvoicingController extends SecurityController {
  constructor(
    @Inject(SECURITY) services: SecurityServices | null,
    @Inject(INVOICING) readonly invoicing: InvoicingService | null,
  ) {
    super(services);
  }
  private get billing() {
    return this.invoicing ?? deny('SECURITY_UNAVAILABLE');
  }
  @Get()
  @contractResponse(invoicePageSchema)
  async list(
    @Param('orgId') org: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.billing.list(
      await this.authenticated(req),
      uuid(org),
      input(invoiceListQuerySchema, query).offset,
    );
  }
  @Get(':id')
  @contractResponse(invoiceRecordSchema)
  async get(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.billing.get(await this.authenticated(req), uuid(org), uuid(id));
  }
  @Post('preview')
  @contractResponse(invoicePreviewSchema, 201)
  @contractBody(invoiceDraftSchema)
  @ApiOperation({
    summary:
      'Calculate an unsaved draft using trusted tenant master data. Does not issue a document.',
  })
  async preview(
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.preview(
      await this.authenticated(req, true),
      uuid(org),
      input(invoiceDraftSchema, body),
    );
  }
  @Post(':id/preview')
  @contractResponse(invoicePreviewSchema, 201)
  @ApiOperation({
    summary:
      'Recalculate a saved draft, or preview the full credit reversal of its original immutable snapshot.',
  })
  async savedPreview(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.billing.preview(
      await this.authenticated(req, true),
      uuid(org),
      undefined,
      uuid(id),
    );
  }
  @Post()
  @contractResponse(invoiceRecordSchema, 201)
  @contractBody(createInvoiceSchema)
  async create(
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { requestKey, ...draft } = input(createInvoiceSchema, body);
    return this.billing.save(
      await this.authenticated(req, true),
      uuid(org),
      draft,
      undefined,
      requestKey,
    );
  }
  @Put(':id')
  @contractResponse(invoiceRecordSchema)
  @contractBody(invoiceDraftSchema)
  async save(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.save(
      await this.authenticated(req, true),
      uuid(org),
      input(invoiceDraftSchema, body),
      uuid(id),
    );
  }
  @Post(':id/finalize')
  @contractResponse(invoiceRecordSchema, 201)
  @contractBody(finalizeInvoiceSchema)
  async finalize(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.finalize(
      await this.authenticated(req, true),
      uuid(org),
      uuid(id),
      input(finalizeInvoiceSchema, body),
    );
  }
  @Post(':id/full-credit')
  @contractResponse(invoiceRecordSchema, 201)
  @contractBody(reverseInvoiceSchema)
  async reverse(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.reverse(
      await this.authenticated(req, true),
      uuid(org),
      uuid(id),
      input(reverseInvoiceSchema, body),
    );
  }
  @Post(':id/corrections')
  @contractBody(correctionInputSchema)
  @contractResponse(invoiceRecordSchema, 201)
  async correction(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.correction(
      await this.authenticated(req, true),
      uuid(org),
      uuid(id),
      input(correctionInputSchema, body),
    );
  }
  @Put(':id/correction')
  @contractBody(correctionInputSchema)
  @contractResponse(invoiceRecordSchema)
  async updateCorrection(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.updateCorrection(
      await this.authenticated(req, true),
      uuid(org),
      uuid(id),
      input(correctionInputSchema, body),
    );
  }
  @Post(':id/cancel')
  @contractBody(cancelInvoiceSchema)
  @contractResponse(invoiceRecordSchema, 201)
  async cancel(
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.billing.cancel(
      await this.authenticated(req, true),
      uuid(org),
      uuid(id),
      input(cancelInvoiceSchema, body),
    );
  }
}
