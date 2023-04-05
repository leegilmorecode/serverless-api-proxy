export type Order = {
  quantity: number;
  productId: string;
};

export type RetrievedOrder = {
  id: string;
  quantity: number;
  productId: string;
  storeId: string;
  created: string;
  type: string;
};

export type StockItem = {
  quantity: number;
  productId: string;
};

export type RetrievedStockItem = {
  id: string;
  quantity: number;
  productId: string;
  created: string;
  type: string;
};
