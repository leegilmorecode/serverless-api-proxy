export type StockItem = {
  id: string;
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
