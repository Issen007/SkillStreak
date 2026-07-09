import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ChatMessageReportReason } from '../entities/team-chat-message-report.entity';

const MAX_NOTE_LENGTH = 140;

export class ReportChatMessageDto {
  @IsEnum(ChatMessageReportReason)
  reason!: ChatMessageReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}
