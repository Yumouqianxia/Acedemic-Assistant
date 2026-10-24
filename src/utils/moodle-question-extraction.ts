export const getMoodleQuestionExtractionScript = () => `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const nodes = Array.from(document.querySelectorAll('.que'));
  const imageToDataUrl = async img => {
    try {
      const response = await fetch(img.currentSrc || img.src, { credentials: 'include' });
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 3000000) return '';
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch { return ''; }
  };
  return Promise.all(nodes.map(async (node, index) => {
    const inputs = Array.from(node.querySelectorAll('input, textarea, select')).filter(input => {
      const type = String(input.type || input.tagName).toLowerCase();
      return !['hidden', 'image', 'submit', 'button', 'reset'].includes(type);
    });
    const checked = inputs.filter(input => input.checked || (input.tagName === 'SELECT' && input.value) || ((input.type === 'text' || input.type === 'number') && input.value));
    const isQuestionImage = img => {
      const style = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      const source = String(img.currentSrc || img.src || '').toLowerCase();
      const marker = String(img.className || '') + ' ' + source;
      const alt = clean(img.alt || img.getAttribute('title'));
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || !rect.width || !rect.height) return false;
      if (/icon|smallicon|mathjax|mathtex|texrender|filter_tex|equation|emoticon|feedback/.test(marker.toLowerCase())) return false;
      const firstChar = alt.charCodeAt(0);
      if (alt.startsWith('$') || firstChar === 92) return false;
      return rect.width >= 48 && rect.height >= 40 && rect.width * rect.height >= 3200;
    };
    const imageElements = Array.from(node.querySelectorAll('.qtext img, .answer img'))
      .filter(isQuestionImage)
      .filter((img, position, all) => all.findIndex(other => (other.currentSrc || other.src) === (img.currentSrc || img.src)) === position)
      .slice(0, 4);
    const images = await Promise.all(imageElements.map(async img => ({
      src: img.currentSrc || img.src || '',
      alt: clean(img.alt || img.getAttribute('title')),
      dataUrl: await imageToDataUrl(img),
    })));
    const formulaGroups = [
      Array.from(node.querySelectorAll('script[type^="math/tex"]')).map(el => clean(el.textContent)),
      Array.from(node.querySelectorAll('[data-latex]')).map(el => clean(el.getAttribute('data-latex'))),
      Array.from(node.querySelectorAll('mjx-container[aria-label]')).map(el => clean(el.getAttribute('aria-label'))),
    ];
    const formulas = (formulaGroups.find(group => group.some(Boolean)) || [])
      .filter((value, position, all) => value && all.indexOf(value) === position);
    const options = Array.from(node.querySelectorAll('.answer label, .answer .r0, .answer .r1, .answer .specificfeedback'))
      .map(el => clean(el.textContent)).filter((value, position, all) => value && all.indexOf(value) === position);
    return {
      id: node.id || 'question-' + (index + 1),
      number: clean(node.querySelector('.qno, .info h3, .info .no')?.textContent) || String(index + 1),
      prompt: clean(node.querySelector('.qtext')?.textContent || node.querySelector('.formulation')?.textContent),
      options,
      answerType: inputs.map(input => input.type || input.tagName.toLowerCase()).filter((value, position, all) => all.indexOf(value) === position).join(', ') || 'unknown',
      currentAnswer: checked.map(input => clean(input.closest('label')?.textContent || input.value)).filter(Boolean).join('; '),
      formulas,
      images: images.filter(image => image.src),
    };
  }));
})()`
