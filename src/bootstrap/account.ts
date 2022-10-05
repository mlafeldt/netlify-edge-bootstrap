export interface Account {
  id?: string;
}

export function parseAccountHeader(accountHeader: string | null): Account {
  if (!accountHeader) {
    return {};
  }

  try {
    const accountData: Account = JSON.parse(atob(accountHeader));

    return accountData;
  } catch {
    return {};
  }
}
