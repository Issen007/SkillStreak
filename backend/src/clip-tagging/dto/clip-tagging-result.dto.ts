import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClipTaggingScoreDto {
  // Not constrained to the enum here on purpose. The analyser is allowed
  // to return names this app does not know — a prompt-set change is a
  // legitimate reason — and ClipTaggingService drops the unrecognised ones
  // with a warning. Rejecting the whole payload would turn a survivable
  // vocabulary drift into every clip failing.
  @IsString()
  @Length(1, 64)
  tag!: string;

  // The column is numeric(4,3) with a CHECK that it lies in [0, 1]. Caught
  // here so a buggy model produces a 400 rather than a constraint
  // violation that strands the lease.
  @IsNumber()
  @Min(0)
  @Max(1)
  score!: number;
}

export class ClipTaggingResultDto {
  @IsUUID()
  leaseId!: string;

  @IsArray()
  // The vocabulary is eight values; anything larger is not a result from a
  // service this app recognises.
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => ClipTaggingScoreDto)
  scores!: ClipTaggingScoreDto[];

  // Recorded on every tag row as `source`, so a stored judgement can
  // always be traced to the model and wording that produced it. A prompt
  // edit changes scores as surely as a model swap, which is why both are
  // required rather than just the model.
  @IsString()
  @Length(1, 128)
  modelId!: string;

  @IsString()
  @Length(1, 64)
  promptSetVersion!: string;
}

export class ClipTaggingFailureDto {
  @IsUUID()
  leaseId!: string;
}
