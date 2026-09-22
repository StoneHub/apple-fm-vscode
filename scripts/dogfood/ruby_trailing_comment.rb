class Cart
  def total
    items.sum(&:price) # <CURSOR>
  end
end
