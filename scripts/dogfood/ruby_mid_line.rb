class UsersController
  def index
    @users = User.where(<CURSOR>)
  end
end
