const pending = new Map();
export function loading(label) {
  const token = Symbol(); pending.set(token, label);
  const render = () => {
    const node = document.getElementById('activity-status');
    node.hidden = !pending.size;
    node.querySelector('span').textContent = [...pending.values()].at(-1) || '';
  };
  render(); let done = false;
  return () => { if (done) return; done = true; pending.delete(token); render(); };
}
