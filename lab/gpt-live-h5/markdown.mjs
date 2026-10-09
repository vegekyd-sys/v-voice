import { marked } from './vendor/marked-18.0.5.mjs';

// Build DOM from Markdown tokens, never from model-supplied HTML. Images stay
// text so viewing a private answer cannot cause an external image request.
export function renderMarkdown(target, text, document = target.ownerDocument) {
  const fragment = document.createDocumentFragment();
  const add = (parent, tag, tokens) => {
    const node = document.createElement(tag); parent.append(node);
    inline(node, tokens ?? []); return node;
  };
  const inline = (parent, tokens) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'strong': case 'em': case 'del': add(parent, token.type, token.tokens); break;
        case 'codespan': add(parent, 'code').textContent = token.text; break;
        case 'br': add(parent, 'br'); break;
        case 'link': {
          let url; try { url = new URL(token.href); } catch {}
          if (url && ['https:', 'http:', 'mailto:'].includes(url.protocol)) {
            const link = add(parent, 'a', token.tokens); link.href = url.href;
            link.rel = 'noopener noreferrer'; link.target = '_blank';
          } else inline(parent, token.tokens ?? [{type:'text',text:token.text}]);
          break;
        }
        case 'image': parent.append(document.createTextNode(token.text ?? '')); break;
        default:
          if (token.tokens) inline(parent, token.tokens);
          else parent.append(document.createTextNode(token.text ?? token.raw ?? ''));
      }
    }
  };
  const blocks = (parent, tokens) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'space': break;
        case 'heading': add(parent, `h${Math.min(6, token.depth)}`, token.tokens); break;
        case 'paragraph': case 'text': add(parent, 'p', token.tokens ?? [{type:'text',text:token.text}]); break;
        case 'blockquote': { const node=add(parent,'blockquote'); blocks(node,token.tokens); break; }
        case 'list': {
          const list=add(parent,token.ordered?'ol':'ul');
          if (token.ordered && Number.isSafeInteger(token.start)) list.start=token.start;
          for (const item of token.items) { const li=add(list,'li'); if(item.task)li.append(document.createTextNode(item.checked?'☑ ':'☐ '));blocks(li,item.tokens); }
          break;
        }
        case 'code': add(add(parent,'pre'),'code').textContent=token.text; break;
        case 'hr': add(parent,'hr'); break;
        case 'table': {
          const wrap=add(parent,'div');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格');
          const table=add(wrap,'table'),head=add(add(table,'thead'),'tr'),body=add(table,'tbody');
          token.header.forEach(cell=>add(head,'th',cell.tokens));
          token.rows.forEach(row=>{const tr=add(body,'tr');row.forEach(cell=>add(tr,'td',cell.tokens));});
          break;
        }
        default: add(parent,'p').textContent=token.raw ?? token.text ?? '';
      }
    }
  };
  blocks(fragment, marked.lexer(String(text), {gfm:true}));
  target.replaceChildren(fragment);
}
