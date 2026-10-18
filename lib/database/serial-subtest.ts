import type { TestContext } from 'node:test';

/** A shared database fixture requires body completion before the parent continues.
 * Do not rely on a runtime's return value from TestContext.test for that ordering.
 */
export async function serialSubtest(
  parent: TestContext,
  name: string,
  body: (child: TestContext) => Promise<void> | void,
) {
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const scheduled = parent.test(name, async child => {
    try {
      await body(child);
      finish();
    } catch (error) {
      fail(error);
      throw error;
    }
  });
  scheduled?.catch(fail);
  await completed;
}
