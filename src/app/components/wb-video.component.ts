import { Component, Input } from "@angular/core";
import { YouTubePlayerModule } from "@angular/youtube-player";

@Component({
  selector: 'wb-video',
  standalone: true,
  imports: [YouTubePlayerModule],
  template: `<youtube-player [videoId]="id" width="100%" height="360"></youtube-player>`,
})
export class WbVideoComponent {
  @Input({ required: true }) id = '';
}
