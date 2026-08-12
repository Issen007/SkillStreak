import { IsString, IsUUID, Length } from 'class-validator';

export class TrainingPlanResultDto {
  @IsUUID()
  leaseId!: string;

  /**
   * The generated session, as Markdown.
   *
   * Capped: a model that loops can produce megabytes, and this is stored
   * in Postgres and rendered to a coach. 20k characters is far more than
   * any 90-minute session needs and far less than a runaway generation.
   */
  @IsString()
  @Length(1, 20_000)
  plan!: string;

  @IsString()
  @Length(1, 128)
  modelId!: string;

  /** Echoed back from the job, so a stored plan names the drills it was
   *  built from even if the library changes afterwards. */
  @IsString()
  @Length(1, 128)
  corpusVersion!: string;
}

export class TrainingPlanFailureDto {
  @IsUUID()
  leaseId!: string;
}
