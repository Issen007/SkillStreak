import { IsUUID } from 'class-validator';

export class BlockChatPlayerDto {
  @IsUUID()
  blockedPlayerId!: string;
}
