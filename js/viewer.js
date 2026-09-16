// pdf.js로 페이지를 화면에 맞춰 렌더링. 다음 페이지를 미리 그려 두어 넘김이 즉시 일어나게 한다.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const MAX_PIXELS = 4096 * 4096; // iPad 캔버스 메모리 한도 안쪽으로
const CACHE_SIZE = 8;

export class Viewer {
  constructor(container) {
    this.container = container;
    this.doc = null;
    this.page = 1;       // 현재 화면 왼쪽(또는 단독) 페이지
    this.spread = false; // 가로 화면에서 2페이지 보기
    this.cache = new Map();
    this.renderToken = 0;
  }

  async open(data, startPage = 1) {
    await this.close();
    // pdf.js가 버퍼를 워커로 넘기며 소유권을 가져가므로 복사본을 전달
    this.doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
    this.page = Math.min(Math.max(1, startPage), this.doc.numPages);
    await this.render();
  }

  async close() {
    this.cache.clear();
    this.container.replaceChildren();
    await this.doc?.destroy();
    this.doc = null;
  }

  get pageCount() { return this.doc?.numPages ?? 0; }
  get step() { return this.isSpread() ? 2 : 1; }

  isSpread() {
    return this.spread && this.container.clientWidth > this.container.clientHeight && this.pageCount > 1;
  }

  visiblePages() {
    const pages = [this.page];
    if (this.isSpread() && this.page + 1 <= this.pageCount) pages.push(this.page + 1);
    return pages;
  }

  label() {
    const v = this.visiblePages();
    return `${v.join('–')} / ${this.pageCount}`;
  }

  async go(delta) {
    if (!this.doc) return false;
    const target = Math.min(Math.max(1, this.page + delta * this.step), this.pageCount);
    if (target === this.page) return false;
    this.page = target;
    await this.render();
    return true;
  }

  invalidate() {
    this.cache.clear();
    return this.render();
  }

  async render() {
    if (!this.doc) return;
    const token = ++this.renderToken;
    const pages = this.visiblePages();
    const slotW = this.container.clientWidth / pages.length;
    const slotH = this.container.clientHeight;

    const canvases = await Promise.all(pages.map(n => this.#canvasFor(n, slotW, slotH)));
    if (token !== this.renderToken) return;
    this.container.replaceChildren(...canvases);

    // 다음·이전 화면 미리 렌더
    const ahead = [];
    for (let i = 1; i <= this.step; i++) ahead.push(pages[pages.length - 1] + i);
    ahead.push(this.page - this.step);
    for (const n of ahead) {
      if (n >= 1 && n <= this.pageCount) this.#canvasFor(n, slotW, slotH).catch(() => {});
    }
  }

  #canvasFor(n, slotW, slotH) {
    const key = `${n}@${Math.round(slotW)}x${Math.round(slotH)}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.#draw(n, slotW, slotH));
      while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }

  async #draw(n, slotW, slotH) {
    const page = await this.doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(slotW / base.width, slotH / base.height);
    let scale = fit * (window.devicePixelRatio || 1);
    const pixels = base.width * base.height * scale * scale;
    if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * fit)}px`;
    canvas.style.height = `${Math.floor(base.height * fit)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }
}
