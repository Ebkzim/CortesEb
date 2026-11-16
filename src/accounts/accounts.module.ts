import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { AccountService } from './account.service.js';

@Module({
  imports: [ImagesModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountsModule {}
