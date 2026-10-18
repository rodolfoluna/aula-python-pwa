import { lexer } from './vendor/marked.js';

// The parser recognizes Markdown; only allowlisted DOM elements are created here.
// HTML, images and links never create executable markup or remote requests.
function renderTokens(parent, tokens = []) {
  for (const token of tokens) {
    let element;
    switch (token.type) {
      case 'space': continue;
      case 'heading': element = document.createElement(`h${token.depth}`); break;
      case 'paragraph': element = document.createElement('p'); break;
      case 'strong': element = document.createElement('strong'); break;
      case 'em': element = document.createElement('em'); break;
      case 'del': element = document.createElement('del'); break;
      case 'blockquote': element = document.createElement('blockquote'); break;
      case 'br': parent.append(document.createElement('br')); continue;
      case 'hr': parent.append(document.createElement('hr')); continue;
      case 'code': {
        const pre = document.createElement('pre'), code = document.createElement('code');
        code.textContent = token.text;
        if (token.lang) code.dataset.language = token.lang.split(/\s+/)[0];
        pre.append(code); parent.append(pre); continue;
      }
      case 'codespan': element = document.createElement('code'); element.textContent = token.text; parent.append(element); continue;
      case 'list': {
        const list = document.createElement(token.ordered ? 'ol' : 'ul');
        if (token.ordered && token.start !== 1) list.start = token.start;
        for (const item of token.items) { const li = document.createElement('li'); if (item.task) li.append(document.createTextNode(item.checked ? '☑ ' : '☐ ')); renderTokens(li, item.tokens); list.append(li); }
        parent.append(list); continue;
      }
      case 'table': {
        const table = document.createElement('table'), head = document.createElement('thead'), row = document.createElement('tr');
        for (const cell of token.header) { const th = document.createElement('th'); renderTokens(th, cell.tokens); row.append(th); }
        head.append(row); table.append(head); const body = document.createElement('tbody');
        for (const cells of token.rows) { const tr = document.createElement('tr'); for (const cell of cells) { const td = document.createElement('td'); renderTokens(td, cell.tokens); tr.append(td); } body.append(tr); }
        table.append(body); parent.append(table); continue;
      }
      case 'link': renderTokens(parent, token.tokens); continue;
      case 'image': parent.append(document.createTextNode(token.text || 'Imagen adjunta')); continue;
      default:
        if (token.tokens) renderTokens(parent, token.tokens);
        else parent.append(document.createTextNode(token.text ?? token.raw ?? ''));
        continue;
    }
    renderTokens(element, token.tokens); parent.append(element);
  }
}
export function renderMarkdown(target, source) {
  target.replaceChildren();
  renderTokens(target, lexer(source, { gfm: true, breaks: false }));
  if (!target.childNodes.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Celda de instrucciones vacía.'; target.append(empty); }
}
