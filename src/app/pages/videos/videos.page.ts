import { Component } from "@angular/core";
import { CardModule } from "primeng/card";
import { CommonModule } from "@angular/common";

@Component({
  standalone: true,
  imports: [CardModule, CommonModule],
  template: `
    <div class="container mt-4">
      <h1>Videos</h1>
      <p>Video tutorials and demos will be available here.</p>
      
      <div class="grid">
        <div class="col-12 md:col-6 lg:col-4">
          <p-card header="Getting Started">
            <p>Learn the basics with this introductory video.</p>
          </p-card>
        </div>
        
        <div class="col-12 md:col-6 lg:col-4">
          <p-card header="Advanced Features">
            <p>Deep dive into advanced functionality.</p>
          </p-card>
        </div>
      </div>
    </div>
  `
})
export class VideosPage {}

