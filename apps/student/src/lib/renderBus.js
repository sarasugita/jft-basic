let renderFn = null;

export const setRenderCallback = (fn) => {
  renderFn = fn;
};

export const triggerRender = () => renderFn?.();
