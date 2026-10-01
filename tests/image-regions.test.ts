import test from 'node:test';
import assert from 'node:assert/strict';
import { fittedImageRegions } from '../miniprogram/services/image-regions';

const region = { field:'title', label:'Title', x:0, y:0, width:1, height:1 };
test('OCR regions follow the actual aspect-fit image rather than the letterboxed frame', () => {
  assert.equal(fittedImageRegions([region],720,960,300,400)[0].style,'left:0%;top:0%;width:100%;height:100%');
  assert.equal(fittedImageRegions([region],800,400,300,400)[0].style,'left:0%;top:31.25%;width:100%;height:37.5%');
  const tall = fittedImageRegions([region],400,1600,300,400)[0].style;
  assert.match(tall,/left:33\.333/);
  assert.match(tall,/top:0%;width:33\.333/);
  assert.deepEqual(fittedImageRegions([region],0,1600,300,400),[]);
});
