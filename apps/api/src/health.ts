import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@gst/contracts';
import type { Database } from '@gst/database';

export const DATABASE = Symbol('DATABASE');
export class HealthDto {
  @ApiProperty({ enum: ['ok'] }) declare status: 'ok';
  @ApiProperty({ enum: ['gst-api'] }) declare service: 'gst-api';
  @ApiProperty({ enum: ['1'] }) declare apiVersion: '1';
}
export class ReadinessDto {
  @ApiProperty({ enum: ['ready'] }) declare status: 'ready';
  @ApiProperty({ enum: ['up'] }) declare database: 'up';
}
@ApiTags('operations')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Pick<Database, 'ready'>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Process liveness; independent of database availability',
  })
  @ApiOkResponse({ type: HealthDto })
  live(): HealthResponse {
    return { status: 'ok', service: 'gst-api', apiVersion: '1' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Database connectivity and foundation schema readiness',
  })
  @ApiOkResponse({ type: ReadinessDto })
  @ApiResponse({
    status: 503,
    description: 'Database unavailable or migration missing',
  })
  async ready(): Promise<ReadinessResponse> {
    try {
      await this.database.ready();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ready', database: 'up' };
  }
}
