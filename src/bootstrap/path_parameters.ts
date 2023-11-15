export const getPathParameters = (
  path: string | undefined,
  url: string,
): Record<string, string> => {
  if (path === undefined) {
    return {};
  }

  const matcher = new URLPattern({ pathname: path });
  const match = matcher.exec(url)?.pathname.groups;

  if (!match) {
    return {};
  }

  const parameters = Object.entries(match).reduce((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }

    return {
      ...acc,
      [key]: value,
    };
  }, {} as Record<string, string>);

  return parameters;
};
