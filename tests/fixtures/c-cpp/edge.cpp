#include <mutex>

#define API_KEY "not-a-real-key"
#define CLEANUP free(ptr); ptr = nullptr
#define COUNT 3 // how many
#define RATIO 0.5 /* half */
#define GREETING "hi // there"

template <typename T>
class Box {
public:
	void set(T value);
	T get() const {
		std::lock_guard<std::mutex> lock(mu_);
		Holder copy(value_);
		return value_;
	}

private:
	T value_;
	mutable std::mutex mu_;
};

template <typename T>
void Box<T>::set(T value) {
	value_ = value;
}

void run() {
	std::lock_guard<std::mutex> lock(global_mu);
	Holder first(second);
	int helper(int);
}
