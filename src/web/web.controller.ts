import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { renderUploadPage } from './upload-page';

@Controller()
export class WebController {
  @Get()
  root(@Res() response: Response) {
    response.redirect(303, '/upload');
  }

  @Get('upload')
  upload(@Res() response: Response) {
    response.type('html').send(renderUploadPage());
  }
}
