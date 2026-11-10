#pragma once
#include <string>

namespace geo {

class Shape {
public:
	virtual ~Shape();
	virtual double area() const = 0;
	std::string label() const { return "shape"; }
};

class Circle : public Shape, private Tagged {
public:
	explicit Circle(double radius);
	double area() const override;
	static Circle unit();

private:
	double radius_;
};

double scale(double value, double factor);
double scale(double value);

template <typename T>
T clamp(T value, T low, T high) {
	return value < low ? low : value > high ? high : value;
}

} // namespace geo
