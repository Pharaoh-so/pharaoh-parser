#include "util.h"
#include <stddef.h>

#define MAX(a, b) ((a) > (b) ? (a) : (b))

static int helper(int x) {
	return MAX(x, 0);
}

int add(int a, int b) {
	return a + b;
}

int sum_point(const point_t *p) {
	if (p == NULL) {
		return 0;
	}
	return add(p->x, helper(p->y));
}
