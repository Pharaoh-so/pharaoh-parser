#include "shape.h"
#include <cmath>

#define SQUARE(x) ((x) * (x))

namespace {

double pi() { return std::acos(-1.0); }

} // namespace

namespace geo {

Shape::~Shape() {}

Circle::Circle(double radius) : radius_(radius) {}

double Circle::area() const {
	if (radius_ <= 0 || std::isnan(radius_)) {
		return 0;
	}
	return pi() * SQUARE(radius_);
}

Circle Circle::unit() { return Circle(1.0); }

double scale(double value, double factor) { return value * factor; }

double scale(double value) { return scale(value, 2.0); }

} // namespace geo
