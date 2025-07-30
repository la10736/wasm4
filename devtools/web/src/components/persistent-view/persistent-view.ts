import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MemoryView } from '../../models/MemoryView';
import { withTheme } from '../../styles/commons';
import { formatHex } from '../../utils/format';
import { ADDR_PERSISTENT } from '../../constants';
import persistentViewCss from './persistent-view.scss?inline';

export const wasm4PersistentViewTagName = 'wasm4-persistent-view';

/**
 * A custom element that renders the persistent memory area for cart data like scores.
 *
 * @example
 *
 * ```ts
 * import { wasm4PersistentViewTagName } from '@wasm4/web-devtools';
 * const elem = document.createElement(wasm4PersistentViewTagName);
 *
 * elem.memoryView = { ... };
 * document.body.appendChild(elem);
 * ```
 */
@customElement(wasm4PersistentViewTagName)
export class Wasm4PersistentView extends LitElement {
  static styles = withTheme(persistentViewCss);

  @property({ type: Object, reflect: false })
  memoryView: MemoryView | null = null;

  @state()
  private selectedOffset = 0;

  private _handleOffsetClick(offset: number) {
    this.selectedOffset = offset;
  }

  private _renderHexGrid() {
    if (!this.memoryView) {
      return html`<div class="no-data">No memory data available</div>`;
    }

    const rows = [];
    for (let row = 0; row < 16; row++) {
      const cells = [];
      for (let col = 0; col < 16; col++) {
        const offset = row * 16 + col;
        const value = this.memoryView.getUint8(ADDR_PERSISTENT + offset);
        const isSelected = offset === this.selectedOffset;
        
        cells.push(html`
          <div 
            class="hex-cell ${isSelected ? 'selected' : ''}"
            @click=${() => this._handleOffsetClick(offset)}
            title="Offset: ${formatHex(offset, 2)}, Value: ${formatHex(value, 2)}"
          >
            ${formatHex(value, 2)}
          </div>
        `);
      }
      
      rows.push(html`
        <div class="hex-row">
          <div class="row-label">${formatHex(row * 16, 2)}</div>
          ${cells}
        </div>
      `);
    }

    return html`
      <div class="hex-grid">
        <div class="hex-header">
          <div class="row-label"></div>
          ${Array.from({length: 16}, (_, i) => html`<div class="col-label">${formatHex(i, 1)}</div>`)}
        </div>
        ${rows}
      </div>
    `;
  }

  private _renderDetails() {
    if (!this.memoryView) {
      return html``;
    }

    const value = this.memoryView.getUint8(ADDR_PERSISTENT + this.selectedOffset);
    const absoluteAddress = ADDR_PERSISTENT + this.selectedOffset;

    return html`
      <div class="details">
        <h4>Selected Byte</h4>
        <div class="detail-row">
          <label>Offset:</label>
          <span>${formatHex(this.selectedOffset, 2)} (${this.selectedOffset})</span>
        </div>
        <div class="detail-row">
          <label>Address:</label>
          <span>${formatHex(absoluteAddress, 4)}</span>
        </div>
        <div class="detail-row">
          <label>Value:</label>
          <span class="value-display">
            ${formatHex(value, 2)} (${value})
          </span>
        </div>
        <div class="detail-row">
          <label>Binary:</label>
          <span>${value.toString(2).padStart(8, '0')}</span>
        </div>
        <div class="detail-row">
          <label>ASCII:</label>
          <span>${value >= 32 && value <= 126 ? String.fromCharCode(value) : '·'}</span>
        </div>
      </div>
    `;
  }

  private _renderUtilities() {
    if (!this.memoryView) {
      return html``;
    }



    const exportData = () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        data[i] = this.memoryView!.getUint8(ADDR_PERSISTENT + i);
      }
      
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'persistent-data.bin';
      a.click();
      URL.revokeObjectURL(url);
    };

    return html`
      <div class="utilities">
        <h4>Utilities</h4>
        <div class="utility-buttons">
          <button @click=${exportData} class="export-btn">Export Data</button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <article class="bg-primary" part="root-view">
        <header>
          <h3>Persistent Memory Area (256 bytes)</h3>
          <p>Cart data storage for scores, settings, and other persistent information</p>
        </header>
        
        <div class="content">
          <div class="hex-section">
            ${this._renderHexGrid()}
          </div>
          
          <div class="sidebar">
            ${this._renderDetails()}
            ${this._renderUtilities()}
          </div>
        </div>
      </article>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [wasm4PersistentViewTagName]: Wasm4PersistentView;
  }
}
