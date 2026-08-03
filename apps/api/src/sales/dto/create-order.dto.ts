import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderDetailDto {
  @IsString()
  goodsId!: string;

  @IsString()
  skuId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitType!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  factAmount?: number;
}

export class CreateOrderDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderType?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sourceType?: number;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  salesName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  salesMobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerMobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderDetailDto)
  details!: OrderDetailDto[];
}
