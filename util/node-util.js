// Node.js compatible version of the delayedExecute function
export const delayedExecute = (func, fast) => {
  return new Promise((resolve) => {
    setTimeout(
      () => {
        resolve(func ? func() : undefined);
      },
      fast ? 1 : 50
    );
  });
};
