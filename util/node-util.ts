// Node.js compatible version of the delayedExecute function
export const delayedExecute = <T>(
  func?: () => T,
  fast?: boolean
): Promise<T | undefined> => {
  return new Promise((resolve) => {
    setTimeout(
      () => {
        resolve(func ? func() : undefined);
      },
      fast ? 1 : 50
    );
  });
};
